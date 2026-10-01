import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Landing from "./pages/Landing";
import AppHome from "./pages/AppHome";
import NewProject from "./pages/NewProject";
import ProjectPage from "./pages/ProjectPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppHome />} />
        <Route path="/app/new" element={<NewProject />} />
        <Route path="/app/p/:id" element={<ProjectPage />} />
        <Route path="/app/p/:id/:tab" element={<ProjectPage />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
