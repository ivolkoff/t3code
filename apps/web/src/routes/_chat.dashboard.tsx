import { createFileRoute } from "@tanstack/react-router";

import { ThreadDashboardPage } from "../components/dashboard/ThreadDashboard";

export const Route = createFileRoute("/_chat/dashboard")({
  component: ThreadDashboardPage,
});
