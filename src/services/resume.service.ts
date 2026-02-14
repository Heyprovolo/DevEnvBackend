import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import type { Resume } from "../types/resume.ts";
import { checkUserQuota, updateUserQuota } from "../utils/quota.utils.ts";

export class ResumeService {
  private db = getFirestore(getFirebaseApp());
  private resumesCollection = this.db.collection("resumes");

  async validateResumeQuota(userId: string) {
    return checkUserQuota(userId, "resume_generator");
  }

  async createResume(userId: string, data: Partial<Resume>) {
    const newRef = this.resumesCollection.doc();
    const resumeData: Partial<Resume> = {
      ...data,
      id: newRef.id,
      userId,
      createdAt: FieldValue.serverTimestamp() as any,
      updatedAt: FieldValue.serverTimestamp() as any,
    };

    await newRef.set(resumeData);

    // Update quota in background
    updateUserQuota(userId, "resume_generator").catch((err) => {
      console.warn("Failed to update resume quota for user", userId, err);
    });

    return { id: newRef.id, ...resumeData };
  }

  async updateResume(userId: string, resumeId: string, data: Partial<Resume>) {
    const docRef = this.resumesCollection.doc(resumeId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error("Resume not found");
    }

    if (doc.data()?.userId !== userId) {
      throw new Error("Unauthorized access to this resume");
    }

    const updateData = {
      ...data,
      updatedAt: FieldValue.serverTimestamp() as any,
    };

    await docRef.update(updateData);
    return resumeId;
  }

  async getResumes(userId: string) {
    const snapshot = await this.resumesCollection
      .where("userId", "==", userId)
      .orderBy("updatedAt", "desc")
      .get();

    const resumes: any[] = [];
    snapshot.forEach((doc) => {
      resumes.push({ id: doc.id, ...doc.data() });
    });
    return resumes;
  }

  async getResumeById(userId: string, resumeId: string) {
    const doc = await this.resumesCollection.doc(resumeId).get();

    if (!doc.exists) {
      throw new Error("Resume not found");
    }

    const data = doc.data() as Resume;

    if (data.userId !== userId) {
      throw new Error("Unauthorized access to this resume");
    }

    return { id: doc.id, ...data };
  }

  async deleteResume(userId: string, resumeId: string) {
    const docRef = this.resumesCollection.doc(resumeId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error("Resume not found");
    }

    if (doc.data()?.userId !== userId) {
      throw new Error("Unauthorized access to this resume");
    }

    await docRef.delete();
    return { id: resumeId };
  }
}

export const resumeService = new ResumeService();
