import type { Metadata } from "next";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./globals.css";
import OfficerNavigation from "@/components/OfficerNavigation";

export const metadata: Metadata = {
  title: "3D ULPIN — Property registry",
  description:
    "A local 3D property registry with evidence-linked records, reviewed revisions and spatial impact queries.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><OfficerNavigation />{children}</body>
    </html>
  );
}
