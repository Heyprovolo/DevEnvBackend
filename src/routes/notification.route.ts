import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { notificationAdminAuth } from "../middlewares/notificationAdminAuth.middleware.ts";
import { authMiddleware } from "../middlewares/auth.middleware.ts";
import {
  broadcastToAllUsers,
  broadcastToTierController,
  deleteNotification,
  getMyNotifications,
  markAllNotificationsReadController,
} from "../controllers/notification.controller.ts";
import { markNotificationReadController } from "../controllers/notification.controller.ts";

const notificationRouter: ExpressRouter = Router();

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     summary: Get my notifications
 *     description: Retrieves a paginated list of notifications for the authenticated user, sorted by most recent.
 *     tags: [Notification]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: The number of notifications to return per page.
 *       - in: query
 *         name: startAfter
 *         schema:
 *           type: string
 *         description: The ID of the last notification from the previous page, used for pagination.
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               title: "Notifications fetched successfully"
 *               message: "Notifications retrieved"
 *               status: "success"
 *               data:
 *                 notifications:
 *                   - id: "notif_123"
 *                     recipient: "user_abc"
 *                     title: "Welcome!"
 *                     message: "Thanks for signing up."
 *                     read: false
 *                     category:
 *                       type: string
 *                       enum: [system, user, promotion, admin, other, profile, proposal, knowledge, community, achievement, subscription, research]
 *                       example: system
 *                     createdAt: "2024-01-01T00:00:00.000Z"
 *                 lastVisibleId: "notif_123"
 *                 totalCount: 100
 *                 pageSize: 20
 *                 currentPage: 1
 *                 totalPages: 5
 *                 remainingPages: 4
 *       401:
 *         description: Unauthorized.
 */
notificationRouter.get("/", authMiddleware, getMyNotifications);

/**
 * @swagger
 * /api/v1/notifications/{id}:
 *   delete:
 *     summary: Delete a notification
 *     description: Deletes a specific notification belonging to the authenticated user.
 *     tags: [Notification]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the notification to delete.
 *     responses:
 *       200:
 *         description: Notification deleted successfully.
 *       401:
 *         description: Unauthorized.
 *       404:
 *         description: Notification not found or user does not have permission to delete it.
 */
notificationRouter.delete("/:id", authMiddleware, deleteNotification);

/**
 * @swagger
 * /api/v1/notifications/broadcast/all:
 *   post:
 *     summary: Broadcast notification to all users (Admin)
 *     description: Sends a notification to every user in the system. Requires admin authentication via a secret header.
 *     tags: [Notification]
 *     parameters:
 *       - in: header
 *         name: X-Notification-Secret
 *         required: true
 *         schema:
 *                     createdAt:
 *                       type: object
 *                       properties:
 *                         seconds:
 *                           type: integer
 *                           example: 1704067200
 *                         nanoseconds:
 *                           type: integer
 *                           example: 123456789
 *         description: The secret token for admin authorization.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               message:
 *                 type: string
 *               link:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: ["system", "user", "promotion", "admin", "other"]
 *                 description: The category/type of notification.
 *             required:
 *               - title
 *               - message
 *             example:
 *               title: "System Maintenance"
 *               message: "We will be undergoing scheduled maintenance this Sunday."
 *               link: "/status"
 *               category: "system"
 *     responses:
 *       202:
 *         description: Broadcast to all users has been initiated.
 *       400:
 *         description: Bad Request - Title and message are required.
 *       403:
 *         description: Forbidden - Invalid or missing admin secret.
 */
notificationRouter.post(
  "/broadcast/all",
  notificationAdminAuth,
  broadcastToAllUsers
);

/**
 * @swagger
 * /api/v1/notifications/broadcast/tier/{tierSlug}:
 *   post:
 *     summary: Broadcast notification to a user tier (Admin)
 *     description: Sends a notification to all users belonging to a specific payment tier. Requires admin authentication via a secret header.
 *     tags: [Notification]
 *     parameters:
 *       - in: path
 *         name: tierSlug
 *         required: true
 *         schema:
 *           type: string
 *         description: The slug of the tier to broadcast to (e.g., 'premium').
 *       - in: header
 *         name: X-Notification-Secret
 *         required: true
 *         schema:
 *           type: string
 *         description: The secret token for admin authorization.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               message:
 *                 type: string
 *               link:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum:
 *                     category: "system"
 *                     createdAt:
 *                       seconds: 1704067200
 *                       nanoseconds: 123456789
 *       403:
 *         description: Forbidden - Invalid or missing admin secret.
 */
notificationRouter.post(
  "/broadcast/tier/:tierSlug",
  notificationAdminAuth,
  broadcastToTierController
);

/**
 * @swagger
 * /api/v1/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     description: Marks all notifications as read for the authenticated user.
 *     tags: [Notification]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               title: "Notifications Read"
 *               message: "5 notifications marked as read"
 *               status: "success"
 *               data:
 *                 count: 5
 *       401:
 *         description: Unauthorized.
 */
notificationRouter.patch(
  "/read-all",
  authMiddleware,
  markAllNotificationsReadController
);

/**
 * @swagger
 * /api/v1/notifications/{id}/read:
 *   patch:
 *     summary: Mark a notification as read
 *     description: Marks a specific notification as read for the authenticated user.
 *     tags: [Notification]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the notification to mark as read.
 *     responses:
 *       200:
 *         description: Notification marked as read successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               title: "Notification Read"
 *               message: "Notification marked as read"
 *               status: "success"
 *               data: null
 *       401:
 *         description: Unauthorized.
 *       404:
 *         description: Notification not found or user does not have permission to mark it as read.
 */
notificationRouter.patch(
  "/:id/read",
  authMiddleware,
  markNotificationReadController
);

export default notificationRouter;
