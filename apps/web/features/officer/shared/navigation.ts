/** Global destinations never depend on a selected building or recent record. */
export const mainNavigation = [
  { key: "block", label: "Block Map", icon: "map", href: "/studio/datasets" },
  {
    key: "register",
    label: "Property Register",
    icon: "register",
    href: "/studio/registry",
  },
  {
    key: "workspace",
    label: "Plan Workspace",
    icon: "workspace",
    href: "/studio/workspaces",
  },
] as const;
