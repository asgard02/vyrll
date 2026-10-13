import { Suspense } from "react";
import { redirect } from "next/navigation";
import { confirmedAccountEmail } from "@/lib/supabase/confirmed-account";
import { VerifyEmailContent } from "./verify-email-form";

type Props = {
  searchParams: Promise<{ email?: string }>;
};

export default async function VerifyEmailPage({ searchParams }: Props) {
  const params = await searchParams;
  const email = params.email?.trim() ?? "";
  if (email && (await confirmedAccountEmail(email))) {
    redirect("/login?error=email_taken");
  }

  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <div className="size-5 animate-spin rounded-full border-2 border-[var(--lp-hairline)] border-t-[var(--lp-accent)]" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
