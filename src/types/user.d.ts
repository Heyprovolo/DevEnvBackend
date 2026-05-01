export interface NewUser {
  userId: string;
  email: string;
  displayName: string | null;
  /** Last inferred country from request geo headers (CDN / optional client hints). Null when unknown. */
  country: string | null;
  /** Subdivision / region when provided by the edge or client hints. Null when unknown. */
  state: string | null;
  tierId: string;
  mailerliteId: string | null;
  polarId: string | null;
  portfolioLink: string | null;
  professionalTitle: string | null;
  emailVerified: boolean;
  otp: string | null;
  otpExpires: Date | null;
  providers: string[];
  activeSessionToken: string | null; // For single-device session tracking
  updatedAt: Date | undefined;
  createdAt: Date | undefined;
}

export interface User extends NewUser {
  id: string;
}
