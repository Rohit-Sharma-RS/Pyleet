/* ============================================
   PyLeet — Firebase Configuration
   ============================================ */

// Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyCDUNKA-AqG20yEYl-f0KfypMeC-TDp3O0",
  authDomain: "pyleet21.firebaseapp.com",
  databaseURL: "https://pyleet21-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pyleet21",
  storageBucket: "pyleet21.firebasestorage.app",
  messagingSenderId: "1026553906890",
  appId: "1:1026553906890:web:621f0ed2b92e737c725633",
  measurementId: "G-7RREJ0W3K4"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Export instances
const auth = firebase.auth();
const rtdb = firebase.database();
