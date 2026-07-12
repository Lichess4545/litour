"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type SocialProvider = Parameters<
  typeof authClient.signIn.social
>[0]["provider"];

/**
 * Adopting an OAuth provider = fill the env vars, uncomment it in
 * src/server/auth.ts, and add an entry here. Nothing else changes.
 */
const oauthProviders: ReadonlyArray<{ id: SocialProvider; label: string }> = [
  // { id: "github", label: "Continue with GitHub" },
  // { id: "google", label: "Continue with Google" },
];

function FieldErrors({
  errors,
}: {
  errors: ReadonlyArray<{ message: string } | undefined>;
}) {
  const messages = errors.flatMap((error) =>
    error === undefined ? [] : [error.message],
  );
  if (messages.length === 0) {
    return null;
  }
  return <p className="text-destructive text-sm">{messages.join(", ")}</p>;
}

function LichessCallbackError() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledErrorRef = useRef<string | null>(null);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error === null || handledErrorRef.current === error) {
      return;
    }
    handledErrorRef.current = error;
    toast.error(searchParams.get("error_description") ?? error);
    router.replace("/sign-in");
  }, [router, searchParams]);

  return null;
}

export default function SignInPage() {
  const router = useRouter();

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: credentialsSchema },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.signIn.email(value);
      if (error !== null) {
        toast.error(error.message ?? "Sign-in failed");
        return;
      }
      router.push("/posts");
      router.refresh();
    },
  });

  const signUp = async () => {
    const parsed = credentialsSchema.safeParse(form.state.values);
    if (!parsed.success) {
      toast.error(parsed.error.issues.map((issue) => issue.message).join(", "));
      return;
    }
    const { email, password } = parsed.data;
    const { error } = await authClient.signUp.email({
      name: email.split("@")[0] ?? email,
      email,
      password,
    });
    if (error !== null) {
      toast.error(error.message ?? "Sign-up failed");
      return;
    }
    router.push("/posts");
    router.refresh();
  };

  const signInWithLichess = async () => {
    const { error } = await authClient.signIn.oauth2({
      providerId: "lichess",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
    });
    if (error !== null) {
      toast.error(error.message ?? "Sign-in failed");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Suspense fallback={null}>
        <LichessCallbackError />
      </Suspense>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Email and password, or an OAuth provider once configured.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="email">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={field.name}>Email</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    autoComplete="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="password">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={field.name}>Password</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    autoComplete="current-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <div className="flex gap-2">
              <Button type="submit">Sign in</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void signUp()}
              >
                Create account
              </Button>
            </div>
          </form>
          <div className="flex flex-col gap-2 border-t pt-4">
            {oauthProviders.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                onClick={() =>
                  void authClient.signIn.social({
                    provider: provider.id,
                    callbackURL: "/posts",
                  })
                }
              >
                {provider.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => void signInWithLichess()}
            >
              Continue with Lichess
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
