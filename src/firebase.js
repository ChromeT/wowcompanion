import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD1rLJKhTNV-4rBkqfABo5RWhtY2ogfEe4",
  authDomain: "wowcompe-4ceaf.firebaseapp.com",
  projectId: "wowcompe-4ceaf",
  storageBucket: "wowcompe-4ceaf.firebasestorage.app",
  messagingSenderId: "833965841533",
  appId: "1:833965841533:web:e2fa99e8ced157d3d02514",
  measurementId: "G-YHPP0PD4F4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
