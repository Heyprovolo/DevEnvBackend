import {
  REFINE_INSTRUCTION_MIN,
  REFINE_INSTRUCTION_MAX,
  validateRefineInstruction,
  type RefineInstructionValidation,
} from "./refineInstructionGuard.ts";

export const PROPOSAL_REFINE_INSTRUCTION_MIN = REFINE_INSTRUCTION_MIN;
export const PROPOSAL_REFINE_INSTRUCTION_MAX = REFINE_INSTRUCTION_MAX;

export type ProposalInstructionValidation = RefineInstructionValidation;

export function validateProposalRefineInstruction(
  raw: string,
): ProposalInstructionValidation {
  return validateRefineInstruction(raw, "proposal");
}
