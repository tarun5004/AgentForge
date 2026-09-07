import { redirect } from "next/navigation";

export default function Home() {
  // Authentication becomes the first screen in the product flow.
  redirect("/login");
}
