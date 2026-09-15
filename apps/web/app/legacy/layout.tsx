import "../globals.css";
import OfficerNavigation from "@/components/OfficerNavigation";

export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return <div className="legacy-app"><OfficerNavigation />{children}</div>;
}
