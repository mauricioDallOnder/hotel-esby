import { AppShell } from "@/components/layout/AppShell";
import IssuesPage from "@/features/IssuesPage";

export default function Route() {
  return <AppShell><IssuesPage roomCondition /></AppShell>;
}
