const form = document.querySelector("#auth-form");
const message = document.querySelector("#auth-message");
const googleButton = document.querySelector("#google-signin-button");
const googleNote = document.querySelector("#google-auth-note");

function showMessage(text, isError = true) {
  if (!message) return;
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const isSignup = document.body.dataset.authPage === "signup";

  if (isSignup && password !== document.querySelector("#confirm-password").value) {
    showMessage("Passwords do not match.");
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const response = await fetch(`/api/auth/${isSignup ? "signup" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "Unable to authenticate.");
    window.location.replace("/index.html");
  } catch (error) {
    showMessage(error.message || "Could not reach FinWise. Check that the local server is running.");
    submitButton.disabled = false;
  }
});

async function setupGoogleSignIn() {
  if (!googleButton || !googleNote) return;

  try {
    const response = await fetch("/api/auth/config");
    const config = await response.json();
    if (!response.ok) throw new Error(config.error?.message || "Could not load sign-in settings.");
    if (!config.googleEnabled || !config.googleClientId) return;
    googleNote.textContent = "Loading Google sign-in...";

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.google?.accounts?.id) {
        googleNote.textContent = "Google sign-in could not be loaded. You can use email and password instead.";
        return;
      }

      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async ({ credential }) => {
          googleNote.textContent = "Signing in with Google…";
          try {
            const signInResponse = await fetch("/api/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential })
            });
            const result = await signInResponse.json();
            if (!signInResponse.ok) throw new Error(result.error?.message || "Google sign-in failed.");
            window.location.replace("/index.html");
          } catch (error) {
            showMessage(error.message || "Google sign-in failed. Please try again.");
            googleNote.textContent = "You can try Google again or use email and password.";
          }
        }
      });
      window.google.accounts.id.renderButton(googleButton, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rect",
        width: Math.min(googleButton.clientWidth || 320, 400)
      });
      googleNote.hidden = true;
    };
    script.onerror = () => {
      googleNote.textContent = "Google sign-in could not be loaded. You can use email and password instead.";
    };
    document.head.append(script);
  } catch (error) {
    googleNote.textContent = error.message || "Could not load sign-in settings.";
  }
}

setupGoogleSignIn();
