"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./landing-page.module.css";
import { type PipelineStage, ReleasePipelineScene } from "./release-pipeline-scene";

type PipelineStoryItem = {
  readonly number: string;
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly meta: string;
};

export function PipelineStory({ stages }: { readonly stages: readonly PipelineStoryItem[] }) {
  const [activeStage, setActiveStage] = useState<PipelineStage>(0);
  const [sceneVisible, setSceneVisible] = useState(false);
  const stageRefs = useRef<Array<HTMLElement | null>>([]);
  const storyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = Number((visible.target as HTMLElement).dataset.stage);
        if (Number.isInteger(index) && index >= 0 && index < stages.length) {
          setActiveStage(Math.min(index, 4) as PipelineStage);
        }
      },
      { rootMargin: "-34% 0px -48% 0px", threshold: [0.1, 0.35, 0.7] },
    );

    stageRefs.current.forEach((element) => {
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [stages.length]);

  useEffect(() => {
    const section = storyRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(
      ([entry]) => setSceneVisible(entry?.isIntersecting ?? false),
      { rootMargin: "220px 0px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const active = stages[activeStage] ?? stages[0];

  return (
    <section
      className={styles.storySection}
      id="how-it-works"
      aria-labelledby="workflow-title"
      ref={storyRef}
    >
      <div className={styles.sectionMarker}>
        <span>RELEASE PATH / 01</span>
        <span>SCROLL TO INSPECT THE CONTROL CHAIN</span>
      </div>
      <div className={styles.storyIntro}>
        <div>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowMark} aria-hidden="true" />A controlled path to release
          </p>
          <h2 id="workflow-title">Evidence first. Authorization last.</h2>
        </div>
        <p>
          Each stage narrows the release surface. The visual stays in motion, but the decision
          remains deterministic and human-owned.
        </p>
      </div>

      <div className={styles.storyLayout}>
        <div className={styles.storySteps}>
          {stages.map((stage, index) => (
            <article
              className={`${styles.storyStep} ${index === activeStage ? styles.storyStepActive : ""}`}
              data-stage={index}
              key={stage.number}
              ref={(element) => {
                stageRefs.current[index] = element;
              }}
            >
              <span className={styles.storyStepNumber}>{stage.number}</span>
              <div>
                <p className={styles.storyStepKicker}>{stage.kicker}</p>
                <h3>{stage.title}</h3>
                <p className={styles.storyStepBody}>{stage.body}</p>
                <span className={styles.storyStepMeta}>{stage.meta}</span>
              </div>
              <span className={styles.storyStepSignal} aria-hidden="true">
                {index === activeStage ? "ACTIVE" : ""}
              </span>
            </article>
          ))}
        </div>

        <div className={styles.storyVisual}>
          <div className={styles.storySticky}>
            <div className={styles.storyVisualHeader}>
              <span>PIPELINE TELEMETRY</span>
              <span>
                <i aria-hidden="true" />
                {active?.kicker.toUpperCase()}
              </span>
            </div>
            <ReleasePipelineScene
              activeStage={activeStage}
              className={styles.storyScene}
              paused={!sceneVisible}
            />
            <div className={styles.storyReadout}>
              <span className={styles.fieldLabel}>Current control surface</span>
              <strong>{active?.title.replace(/[.]/g, "")}</strong>
              <span>{active?.meta}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
