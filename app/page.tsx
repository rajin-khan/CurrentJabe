import { HomeExperience } from "@/components/home-experience";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function HomePage() {
  return (
    <main>
      <SiteHeader />
      <HomeExperience />
      <SiteFooter />
    </main>
  );
}
