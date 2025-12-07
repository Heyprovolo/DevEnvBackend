export enum NotificationCategory {
  SYSTEM = "system",
  USER = "user",
  PROMOTION = "promotion",
  ADMIN = "admin",
  OTHER = "other",
  PROFILE = "profile",
  PROPOSAL = "proposal",
  KNOWLEDGE = "knowledge",
  COMMUNITY = "community",
  ACHIEVEMENT = "achievement",
  SUBSCRIPTION = "subscription",
  RESEARCH = "research",
}

export const NOTIFICATION_CATEGORIES: string[] =
  Object.values(NotificationCategory);

export interface Notification {
  id: string; // Firestore document ID
  recipient: string; // Corresponds to a User's ID (UID)
  title: string;
  message: string;
  read: boolean;
  link?: string;
  category: NotificationCategory;
  createdAt: FirebaseFirestore.Timestamp;
}
