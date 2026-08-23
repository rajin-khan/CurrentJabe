"use client";

import { useLanguage } from "@/components/language-provider";

export function StorySections() {
  const { text } = useLanguage();

  return (
    <>
      <section className="story" id="how-it-works">
        <div className="story__intro">
          <p className="eyebrow">{text.story.eyebrow}</p>
          <h2>{text.story.title}</h2>
          <p>{text.story.body}</p>
        </div>
        <div className="story__steps">
          {text.story.cards.map(([number, title, body]) => (
            <article className="story-step" key={number}>
              <span>{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="trust-section">
        <div className="trust-section__copy">
          <p className="eyebrow eyebrow--light">{text.proof.eyebrow}</p>
          <h2>{text.proof.title}</h2>
          <p>{text.proof.body}</p>
        </div>
        <div className="trust-section__numbers" aria-label={text.proof.rulesLabel}>
          <div>
            <strong>{text.proof.ten}</strong>
            <span>{text.proof.tenLabel}</span>
          </div>
          <div>
            <strong>{text.proof.thirty}</strong>
            <span>{text.proof.thirtyLabel}</span>
          </div>
          <div>
            <strong>{text.proof.zero}</strong>
            <span>{text.proof.zeroLabel}</span>
          </div>
        </div>
      </section>
    </>
  );
}
