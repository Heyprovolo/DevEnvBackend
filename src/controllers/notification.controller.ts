import { markAllNotificationsAsRead } from "../services/notification.service.ts";
import { markNotificationAsRead } from "../services/notification.service.ts";
import type { Response, Request } from "express";
import {
  getUserNotifications,
  deleteUserNotification,
  broadcastToAll,
  broadcastToTier,
} from "../services/notification.service.ts";
import { newErrorResponse, newSuccessResponse } from "../utils/apiResponse.ts";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import { getFirestore } from "firebase-admin/firestore";

// --- User-facing Controllers ---
export const getMyNotifications = async (req: Request, res: Response) => {
  try {
    if (!req.userID)
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));

    const { limit, startAfter } = req.query;

    const limitStr = limit as string | undefined;
    const parsedLimit = limitStr ? parseInt(limitStr, 10) : undefined;

    const options: { limit?: number; startAfter?: string } = {};
    if (parsedLimit !== undefined && !Number.isNaN(parsedLimit)) {
      options.limit = parsedLimit;
    }
    if (startAfter !== undefined) {
      options.startAfter = startAfter as string;
    }

    // Get paginated notifications
    const { notifications, lastVisibleId } = await getUserNotifications(
      req.userID,
      options
    );

    // Get total count
    const app = getFirebaseApp();
    const db = getFirestore(app);
    const notificationsCollection = db.collection("notifications");
    const totalSnapshot = await notificationsCollection
      .where("recipient", "==", req.userID)
      .get();
    const totalCount = totalSnapshot.size;

    // Calculate remaining pages
    const pageSize = options.limit || 20;
    const currentPage = options.startAfter
      ? Math.floor(
          totalSnapshot.docs.findIndex((doc) => doc.id === options.startAfter) /
            pageSize
        ) + 2
      : 1;
    const totalPages = Math.ceil(totalCount / pageSize);
    const remainingPages = totalPages - currentPage;

    res.status(200).json(
      newSuccessResponse(
        "Notifications fetched successfully",
        "Notifications retrieved",
        {
          notifications,
          lastVisibleId,
          totalCount,
          pageSize,
          currentPage,
          totalPages,
          remainingPages,
        }
      )
    );
  } catch (error) {
    console.error("[getMyNotifications] Error fetching notifications:", error);
    res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to retrieve your notifications. Please try again later."
        )
      );
  }
};

export const deleteNotification = async (req: Request, res: Response) => {
  try {
    if (!req.userID)
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));

    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json(
          newErrorResponse("Invalid Request", "Notification ID is required")
        );
    }
    const wasDeleted = await deleteUserNotification(id, req.userID);

    if (!wasDeleted) {
      return res
        .status(404)
        .json(
          newErrorResponse(
            "Not Found",
            "Notification not found or access denied"
          )
        );
    }

    res
      .status(200)
      .json(
        newSuccessResponse(
          "Notification Deleted",
          "Notification deleted successfully",
          null
        )
      );
  } catch (error) {
    console.error("[deleteNotification] Error deleting notification:", error);
    res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to delete notification. Please try again later."
        )
      );
  }
};

// PATCH /api/v1/notifications/read-all
export const markAllNotificationsReadController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.userID)
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));

    const count = await markAllNotificationsAsRead(req.userID);
    res
      .status(200)
      .json(
        newSuccessResponse(
          "Notifications Read",
          `${count} notifications marked as read`,
          { count }
        )
      );
  } catch (error) {
    console.error(
      "[markAllNotificationsReadController] Error marking all notifications as read:",
      error
    );
    res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to mark all notifications as read. Please try again later."
        )
      );
  }
};

// PATCH /api/v1/notifications/:id/read
export const markNotificationReadController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.userID)
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));

    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json(
          newErrorResponse("Invalid Request", "Notification ID is required")
        );
    }
    const wasMarked = await markNotificationAsRead(id, req.userID);
    if (!wasMarked) {
      return res
        .status(404)
        .json(
          newErrorResponse(
            "Not Found",
            "Notification not found or access denied"
          )
        );
    }
    res
      .status(200)
      .json(
        newSuccessResponse(
          "Notification Read",
          "Notification marked as read",
          null
        )
      );
  } catch (error) {
    console.error(
      "[markNotificationReadController] Error marking notification as read:",
      error
    );
    res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to mark notification as read. Please try again later."
        )
      );
  }
};

// --- Admin Broadcast Controllers ---
export const broadcastToAllUsers = async (req: Request, res: Response) => {
  try {
    const { title, message, link, category } = req.body;
    if (!title || !message) {
      return res
        .status(400)
        .json(
          newErrorResponse("Invalid Request", "Title and message are required")
        );
    }

    await broadcastToAll(title, message, link, category);
    res
      .status(202)
      .json(
        newSuccessResponse(
          "Broadcast Initiated",
          "Broadcast to all users initiated.",
          null
        )
      );
  } catch (error) {
    res
      .status(500)
      .json(
        newErrorResponse("Broadcast Error", "Error broadcasting notification")
      );
  }
};

export const broadcastToTierController = async (
  req: Request,
  res: Response
) => {
  try {
    const { tierSlug } = req.params;
    const { title, message, link, category } = req.body;

    if (!tierSlug) {
      return res
        .status(400)
        .json(
          newErrorResponse("Invalid Request", "tierSlug parameter is required")
        );
    }

    if (!title || !message) {
      return res
        .status(400)
        .json(
          newErrorResponse("Invalid Request", "Title and message are required")
        );
    }

    await broadcastToTier(tierSlug, title, message, link, category);
    res
      .status(202)
      .json(
        newSuccessResponse(
          "Broadcast Initiated",
          `Broadcast to tier '${tierSlug}' initiated.`,
          null
        )
      );
  } catch (error) {
    res
      .status(500)
      .json(newErrorResponse("Broadcast Error", "Error broadcasting to tier"));
  }
};
