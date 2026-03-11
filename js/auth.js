/* ============================================
   PyLeet — Authentication Layer
   ============================================ */

// --- Auth State ---
let currentUser = null;
let isAuthReady = false;

// --- Initialize Auth ---
function initAuth() {
  return new Promise((resolve) => {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        updateAuthUI(user);
        // Load cloud data after auth
        await syncLoadFromCloud();
        loadHistory();
      } else {
        // No user — sign in anonymously
        try {
          await auth.signInAnonymously();
        } catch (err) {
          console.error("Anonymous auth failed:", err);
          updateAuthUI(null);
        }
      }
      if (!isAuthReady) {
        isAuthReady = true;
        resolve();
      }
    });
  });
}

// --- Get Current User ID ---
function getCurrentUserId() {
  return currentUser ? currentUser.uid : null;
}

// --- Sign Up (link anonymous account to username/password) ---
async function signUp(username, password) {
  if (!username || !password) throw new Error("Username and password required");
  if (username.length < 3)
    throw new Error("Username must be at least 3 characters");
  if (password.length < 6)
    throw new Error("Password must be at least 6 characters");

  // Use username as a fake email for Firebase Email/Password auth
  const email = `${username.toLowerCase().trim()}@pyleet.app`;

  try {
    if (currentUser && currentUser.isAnonymous) {
      // Link anonymous account to email/password
      const credential = firebase.auth.EmailAuthProvider.credential(
        email,
        password,
      );
      const result = await currentUser.linkWithCredential(credential);
      currentUser = result.user;

      // Save profile to Realtime Database
      await rtdb.ref("users/" + currentUser.uid + "/profile").set({
        username: username.trim(),
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
      });

      // Push any existing local data to cloud
      await syncPushToCloud();
      updateAuthUI(currentUser);
      return { success: true, message: "Account created! Your data will now sync across devices." };
    } else {
      // Create a new account
      const result = await auth.createUserWithEmailAndPassword(email, password);
      currentUser = result.user;

      await rtdb.ref("users/" + currentUser.uid + "/profile").set({
        username: username.trim(),
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
      });

      await syncPushToCloud();
      updateAuthUI(currentUser);
      return { success: true, message: "Account created!" };
    }
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      throw new Error("This username is already taken. Try a different one.");
    }
    if (err.code === "auth/credential-already-in-use") {
      throw new Error("This username is already taken. Try a different one.");
    }
    throw err;
  }
}

// --- Log In ---
async function logIn(username, password) {
  if (!username || !password) throw new Error("Username and password required");

  const email = `${username.toLowerCase().trim()}@pyleet.app`;

  try {
    // If currently anonymous, store local data before switching
    const localHistory = getHistory();

    const result = await auth.signInWithEmailAndPassword(email, password);
    currentUser = result.user;

    // Update last seen
    await rtdb.ref("users/" + currentUser.uid + "/profile/lastSeen").set(
      firebase.database.ServerValue.TIMESTAMP
    );

    // Merge any local anonymous data with cloud data
    if (localHistory.length > 0) {
      await syncMergeLocalToCloud(localHistory);
    }

    updateAuthUI(currentUser);
    return { success: true, message: "Logged in! Your data is syncing..." };
  } catch (err) {
    if (
      err.code === "auth/user-not-found" ||
      err.code === "auth/wrong-password" ||
      err.code === "auth/invalid-credential"
    ) {
      throw new Error("Invalid username or password.");
    }
    throw err;
  }
}

// --- Log Out ---
async function logOut() {
  try {
    await auth.signOut();
    // After sign out, onAuthStateChanged will fire and sign in anonymously
    return { success: true, message: "Logged out." };
  } catch (err) {
    throw err;
  }
}

// --- Update Auth UI ---
function updateAuthUI(user) {
  const authBtn = document.getElementById("authBtn");
  const authBtnText = document.getElementById("authBtnText");
  const userBadge = document.getElementById("userBadge");
  const userBadgeName = document.getElementById("userBadgeName");
  const syncIndicator = document.getElementById("syncIndicator");

  if (!authBtn) return;

  if (user && !user.isAnonymous) {
    // Logged in with username
    const email = user.email || "";
    const username = email.replace("@pyleet.app", "");

    authBtn.style.display = "none";
    userBadge.style.display = "flex";
    userBadgeName.textContent = username;
    if (syncIndicator) syncIndicator.classList.add("synced");
  } else {
    // Anonymous or no user
    authBtn.style.display = "flex";
    userBadge.style.display = "none";
    if (authBtnText) authBtnText.textContent = "Sign In";
    if (syncIndicator) syncIndicator.classList.remove("synced");
  }
}

// --- Auth Modal ---
function openAuthModal(mode = "login") {
  const modal = document.getElementById("authModal");
  const modalTitle = document.getElementById("authModalTitle");
  const authSubmitBtn = document.getElementById("authSubmitBtn");
  const authToggleText = document.getElementById("authToggleText");
  const authError = document.getElementById("authError");
  const authSuccess = document.getElementById("authSuccess");

  modal.classList.add("active");
  modal.dataset.mode = mode;
  authError.textContent = "";
  authSuccess.textContent = "";
  document.getElementById("authUsername").value = "";
  document.getElementById("authPassword").value = "";

  if (mode === "signup") {
    modalTitle.textContent = "Create Account";
    authSubmitBtn.textContent = "Sign Up";
    authToggleText.innerHTML =
      'Already have an account? <a href="#" onclick="openAuthModal(\'login\'); return false;">Log in</a>';
  } else {
    modalTitle.textContent = "Log In";
    authSubmitBtn.textContent = "Log In";
    authToggleText.innerHTML =
      'Don\'t have an account? <a href="#" onclick="openAuthModal(\'signup\'); return false;">Sign up</a>';
  }
}

function closeAuthModal() {
  document.getElementById("authModal").classList.remove("active");
}

async function submitAuth() {
  const modal = document.getElementById("authModal");
  const mode = modal.dataset.mode;
  const username = document.getElementById("authUsername").value.trim();
  const password = document.getElementById("authPassword").value;
  const authError = document.getElementById("authError");
  const authSuccess = document.getElementById("authSuccess");
  const submitBtn = document.getElementById("authSubmitBtn");

  authError.textContent = "";
  authSuccess.textContent = "";
  submitBtn.disabled = true;
  submitBtn.textContent = mode === "signup" ? "Creating..." : "Logging in...";

  try {
    let result;
    if (mode === "signup") {
      result = await signUp(username, password);
    } else {
      result = await logIn(username, password);
    }
    authSuccess.textContent = result.message;
    setTimeout(() => closeAuthModal(), 1500);
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = mode === "signup" ? "Sign Up" : "Log In";
  }
}

// Handle Enter key in auth modal
function handleAuthKeydown(e) {
  if (e.key === "Enter") submitAuth();
}
