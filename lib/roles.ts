export const roles = {
  direction: "Direction",
  employe: "Employé",
} as const;

export type Role = keyof typeof roles;

export function isRole(value: unknown): value is Role {
  return value === "direction" || value === "employe";
}
