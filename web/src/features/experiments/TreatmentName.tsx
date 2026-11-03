import type { Treatment } from "../../domain/experiments/schema";
import { TreatmentDot } from "./TreatmentDot";

/** A treatment by its color and name. */
export function TreatmentName({ treatment }: { treatment: Treatment }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TreatmentDot position={treatment.position} />
      <span className="truncate">{treatment.name}</span>
    </span>
  );
}
