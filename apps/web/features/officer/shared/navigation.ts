/** Global destinations never depend on a selected building or recent record. */
export const mainNavigation = [
  { key: "block", label: "Block Map", icon: "map", href: "/blocks" },
  {
    key: "register",
    label: "Property Register",
    icon: "register",
    href: "/register",
  },
  {
    key: "workspace",
    label: "Plan Workspace",
    icon: "workspace",
    href: "/workspace",
  },
] as const;
