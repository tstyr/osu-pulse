import { redirect } from "next/navigation";

export default function LegacyRenderPage() {
  redirect("/dashboard/render");
}
