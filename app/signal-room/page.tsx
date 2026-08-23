import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin-console";

export const metadata: Metadata = {
  title: "Signal room",
  robots: { index: false, follow: false, nocache: true },
};

export default function SignalRoomPage() {
  return <AdminConsole />;
}
