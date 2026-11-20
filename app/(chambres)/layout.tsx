import { AppShell } from "@/components/layout/AppShell";
import { RoomNavigation } from "@/components/layout/RoomNavigation";

export default function RoomsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <RoomNavigation />
      {children}
    </AppShell>
  );
}
