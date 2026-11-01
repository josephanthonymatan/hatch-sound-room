import { Haptics } from "./components/haptics";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SoundRoomApp } from "./components/sound-room-app";
import "@fontsource-variable/inter-tight/wght.css";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><Haptics><SoundRoomApp /></Haptics></StrictMode>,
);
