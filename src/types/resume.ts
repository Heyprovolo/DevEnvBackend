import { Timestamp } from "firebase-admin/firestore";

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  summary?: string;
  jobTitle?: string;
  links?: {
    linkedin?: string;
    github?: string;
    portfolio?: string;
    [key: string]: string | undefined;
  };
}

export interface EducationItem {
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  description?: string;
}

export interface ExperienceItem {
  company: string;
  position: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  description?: string;
  location?: string;
}

export interface SkillItem {
  name: string;
  level?: "Beginner" | "Intermediate" | "Advanced" | "Expert";
}

export interface LanguageItem {
  name: string;
  level?: "Beginner" | "Intermediate" | "Advanced" | "Expert";
}

export interface ProjectItem {
  title: string;
  description?: string;
  link?: string;
  technologies?: string[];
  startDate?: string;
  endDate?: string;
}

export interface ResumeContent {
  personalInfo: PersonalInfo;
  education?: EducationItem[];
  experience?: ExperienceItem[];
  skills?: SkillItem[];
  projects?: ProjectItem[];
  languages?: LanguageItem[];
  certifications?: any[];
  [key: string]: any;
}

export interface Resume {
  id?: string;
  userId: string;
  title: string;
  template: string;
  content: ResumeContent;
  latex?: string;
  sectionOrder?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SaveResumeRequest {
  resumeId?: string;
  title?: string;
  template?: string;
  content: ResumeContent;
  latex?: string;
  sectionOrder?: string[];
}
