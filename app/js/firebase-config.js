/* Meal Planner web app: Firebase connection settings.

   STEP 6 of FIREBASE-SETUP.md: replace null below with the config object the Firebase console shows
   (Project settings > General > Your apps > the web app > "SDK setup and configuration" > Config). It looks like:

   window.MP_FIREBASE_CONFIG = {
     apiKey: 'AIza...',
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project',
     storageBucket: 'your-project.firebasestorage.app',
     messagingSenderId: '1234567890',
     appId: '1:1234567890:web:abc123'
   };

   These values are not secrets: every Firebase web page shows them to its visitors. What protects the data is
   firestore.rules (each account reads and writes only its own space). Never put a password, a service-account key
   or a private key here.

   While this stays null the app runs in PRACTICE MODE: accounts and data are kept only in this browser. */
window.MP_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAADbXh2befoGD6YD37VNY-izcasWFGt6g',
  authDomain: 'meal-planner-d5713.firebaseapp.com',
  projectId: 'meal-planner-d5713',
  storageBucket: 'meal-planner-d5713.firebasestorage.app',
  messagingSenderId: '188470413038',
  appId: '1:188470413038:web:0d1a5dd7a021151a2a15ff'
};
