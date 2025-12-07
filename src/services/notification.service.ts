import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import {
  NotificationCategory,
  type Notification,
} from "../types/notification.ts";

// Broadcasts a notification to all users.
export const broadcastToAll = async (
  title: string,
  message: string,
  link?: string,
  category: NotificationCategory = NotificationCategory.SYSTEM
): Promise<void> => {
  const app = getFirebaseApp();
  const db = getFirestore(app);

  const notificationsCollection = db.collection("notifications");
  const usersCollection = db.collection("users");

  const usersSnapshot = await usersCollection.get();
  if (usersSnapshot.empty) {
    return;
  }

  const batch = db.batch();
  usersSnapshot.forEach((userDoc) => {
    const userData = userDoc.data();
    if (userData?.userId) {
      const newNotifRef = notificationsCollection.doc();
      batch.set(newNotifRef, {
        recipient: userData.userId,
        title,
        message,
        link: link || null,
        read: false,
        category,
        createdAt: new Date(),
      });
    }
  });

  await batch.commit();
};

// Broadcasts a notification to users of a specific tier.
export const broadcastToTier = async (
  tierSlug: string,
  title: string,
  message: string,
  link?: string,
  category: NotificationCategory = NotificationCategory.SYSTEM
): Promise<void> => {
  const app = getFirebaseApp();
  const db = getFirestore(app);

  const notificationsCollection = db.collection("notifications");
  const usersCollection = db.collection("users");

  const usersSnapshot = await usersCollection
    .where("tierSlug", "==", tierSlug)
    .get();
  if (usersSnapshot.empty) {
    return;
  }

  const batch = db.batch();
  usersSnapshot.forEach((userDoc) => {
    const userData = userDoc.data();
    // Ensure the document has a userId before creating a notification
    if (userData && userData.userId) {
      const newNotifRef = notificationsCollection.doc();
      batch.set(newNotifRef, {
        recipient: userData.userId, // Correct: Use the userId from the document data
        title,
        message,
        link: link || null,
        read: false,
        category,
        createdAt: new Date(),
      });
    }
  });

  await batch.commit();
};

// Fetches notifications for a specific user.
export const getUserNotifications = async (
  userId: string,
  options: { limit?: number; startAfter?: string } = {}
): Promise<{ notifications: Notification[]; lastVisibleId: string | null }> => {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const notificationsCollection = db.collection("notifications");

  const queryLimit = options.limit || 20;
  let query = notificationsCollection
    .where("recipient", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(queryLimit);

  if (options.startAfter) {
    const lastVisibleDoc = await notificationsCollection
      .doc(options.startAfter)
      .get();
    if (lastVisibleDoc.exists) {
      query = query.startAfter(lastVisibleDoc);
    }
  }

  const snapshot = await query.get();

  if (snapshot.empty) {
    return { notifications: [], lastVisibleId: null };
  }

  const notifications = snapshot.docs.map(
    (doc) =>
      ({
        id: doc.id,
        ...doc.data(),
      } as Notification)
  );

  const lastVisible = snapshot.docs[snapshot.docs.length - 1];
  const lastVisibleId = lastVisible ? lastVisible.id : null;

  return { notifications, lastVisibleId };
};

// Deletes a single notification for a user, ensuring ownership.
export const deleteUserNotification = async (
  notificationId: string,
  userId: string
): Promise<boolean> => {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const notifRef = db.collection("notifications").doc(notificationId);
  const notifDoc = await notifRef.get();

  if (!notifDoc.exists || notifDoc.data()?.recipient !== userId) {
    return false;
  }

  await notifRef.delete();
  return true;
};

// Marks all notifications as read for a user.
export const markAllNotificationsAsRead = async (
  userId: string
): Promise<number> => {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const notificationsCollection = db.collection("notifications");
  const snapshot = await notificationsCollection
    .where("recipient", "==", userId)
    .where("read", "==", false)
    .get();
  if (snapshot.empty) return 0;
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.update(doc.ref, { read: true });
  });
  await batch.commit();
  return snapshot.size;
};

// Marks a single notification as read for a user, ensuring ownership.
export const markNotificationAsRead = async (
  notificationId: string,
  userId: string
): Promise<boolean> => {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const notifRef = db.collection("notifications").doc(notificationId);
  const notifDoc = await notifRef.get();

  if (!notifDoc.exists || notifDoc.data()?.recipient !== userId) {
    return false;
  }

  await notifRef.update({ read: true });
  return true;
};

// Sends a notification to a single user.
export const sendNotificationToUser = async (
  userId: string,
  title: string,
  message: string,
  link?: string,
  category: NotificationCategory = NotificationCategory.SYSTEM
): Promise<string> => {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const notificationsCollection = db.collection("notifications");

  const newNotifRef = notificationsCollection.doc();
  await newNotifRef.set({
    recipient: userId,
    title,
    message,
    link: link || null,
    read: false,
    category,
    createdAt: new Date(),
  });

  return newNotifRef.id;
};
