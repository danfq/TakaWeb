import { useState } from "react";
import { actions } from "astro:actions";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * end the session and go back to sign in
 */
export default function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await actions.auth.logout();
    window.location.assign("/login");
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Sign out"
      title="Sign out"
      disabled={pending}
      onClick={logout}
    >
      {pending ? <Spinner /> : <LogOut />}
    </Button>
  );
}
