import React from "react";
import { Composition } from "remotion";
import { ChaosLabDemo } from "./ChaosLabDemo";
import { timing } from "./timing";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="ChaosLabDemo"
      component={ChaosLabDemo}
      durationInFrames={timing.totalFrames}
      fps={timing.fps}
      width={timing.width}
      height={timing.height}
    />
  </>
);
