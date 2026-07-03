import { useState } from "react";
import { CSS } from "./shared.js";
import HomeScreen from "./Homescreen.js";
import Tester from "./Tester.js";
import PrivacyPolicy from "./PrivacyPolicy.js";

export default function App() {
  const [view, setView] = useState(
    window.location.pathname === "/privacy" ? "privacy" : "home"
  );

  return (
    <div className="lt-root">
      <style>{CSS}</style>
      {view === "home" && (
        <HomeScreen
          onLaunch={() => setView("tester")}
          onPrivacy={() => { window.history.pushState({}, "", "/privacy"); setView("privacy"); }}
        />
      )}
      {view === "tester" && <Tester onBack={() => setView("home")} />}
      {view === "privacy" && (
        <PrivacyPolicy onBack={() => { window.history.pushState({}, "", "/"); setView("home"); }} />
      )}
    </div>
  );
}