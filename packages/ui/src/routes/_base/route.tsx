
import { createFileRoute } from "@tanstack/react-router";
import { BaseLayout } from "@/components/layout/base-layout";

export const Route = createFileRoute("/_base")({
  component: BaseLayout,
});