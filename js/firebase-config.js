export const firebaseConfig = {
  apiKey: "AIzaSyCErLlfSKx23vrFdFfMlVp9v21iElnDGmw",
  authDomain: "smart-task-manager-12a2a.firebaseapp.com",
  projectId: "smart-task-manager-12a2a",
  storageBucket: "smart-task-manager-12a2a.firebasestorage.app",
  messagingSenderId: "676060144174",
  appId: "1:676060144174:web:23d7cade55bdb1833bf5bf"
};

export const hasFirebaseConfig = !Object.values(firebaseConfig).some((value) => value.startsWith("PASTE_"));
