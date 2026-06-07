import { useState } from "react";
import { CSS } from "./shared.js";
import HomeScreen from "./Homeccreen.js";
import Tester from "./Tester.js";

export default function App() {
  const [view, setView] = useState("home");

  return (
    <div className="lt-root">
      <style>{CSS}</style>
      {view === "home"
        ? <HomeScreen onLaunch={() => setView("tester")} />
        : <Tester onBack={() => setView("home")} />}
    </div>
  );
}