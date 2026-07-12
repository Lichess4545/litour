import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignInPage from "./page";

type OAuth2SignIn = (input: {
  providerId: string;
  callbackURL?: string;
  errorCallbackURL?: string;
}) => Promise<{ error: { message?: string } | null }>;

type EmailSignIn = (input: {
  email: string;
  password: string;
}) => Promise<{ error: { message?: string } | null }>;

const { oauth2Mock, emailSignInMock, replaceMock, useSearchParamsMock } =
  vi.hoisted(() => ({
    oauth2Mock: vi.fn<OAuth2SignIn>(),
    emailSignInMock: vi.fn<EmailSignIn>(),
    replaceMock: vi.fn<(href: string) => void>(),
    useSearchParamsMock: vi.fn<() => URLSearchParams>(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: replaceMock,
  }),
  useSearchParams: useSearchParamsMock,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: emailSignInMock,
      social: vi.fn(),
      oauth2: oauth2Mock,
    },
    signUp: {
      email: vi.fn(),
    },
  },
}));

describe("SignInPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    oauth2Mock.mockResolvedValue({ error: null });
    emailSignInMock.mockResolvedValue({ error: null });
  });

  it("requests an app-owned errorCallbackURL when signing in with lichess", async () => {
    render(<SignInPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Lichess" }),
    );

    await waitFor(() => {
      expect(oauth2Mock).toHaveBeenCalledWith({
        providerId: "lichess",
        callbackURL: "/",
        errorCallbackURL: "/sign-in",
      });
    });
  });

  it("surfaces a toast and strips the query param when the callback redirects back with an error", async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams(
        "error=access_denied&error_description=User+denied+access",
      ),
    );

    render(<SignInPage />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("User denied access");
      expect(replaceMock).toHaveBeenCalledWith("/sign-in");
    });
  });

  it("does not toast or strip anything when there is no error param", async () => {
    render(<SignInPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sign in" }),
      ).toBeInTheDocument();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("falls back to the raw error code when error_description is absent", async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams("error=access_denied"),
    );

    render(<SignInPage />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("access_denied");
      expect(replaceMock).toHaveBeenCalledWith("/sign-in");
    });
  });

  it("surfaces the toast exactly once under StrictMode's double effect invocation", async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams(
        "error=access_denied&error_description=User+denied+access",
      ),
    );

    render(
      <StrictMode>
        <SignInPage />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
  });
});
