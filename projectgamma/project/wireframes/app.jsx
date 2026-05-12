// Main app — Tweaks panel + DesignCanvas with all screens & variants

const { useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "style": "sketchy",
  "color": false,
  "density": "regular"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply global classes to <body> so styles cascade everywhere (including
  // inside iOS frame children, which are not nested under our root).
  useEffect(() => {
    document.body.classList.toggle("wf-color", !!t.color);
    document.body.classList.toggle("wf-density-compact", t.density === "compact");
    document.body.classList.toggle("wf-density-airy", t.density === "airy");
  }, [t.color, t.density]);

  const cls = "wf-art " + (t.style === "clean" ? "clean" : "");

  // Wrap each screen render in artClass for per-artboard styling.
  const A = ({ variant, render }) => <div className={cls}>{render(variant)}</div>;

  return (
    <>
      <DesignCanvas>
        <DCSection id="onboarding" title="01 · Onboarding" subtitle="willkommen + neues projekt anlegen">
          <DCArtboard id="amb" label="A · Ambient" width={780} height={520}>
            <A variant="ambient" render={(v) => <WFOnboarding variant={v} />} />
          </DCArtboard>
          <DCArtboard id="cha" label="B · Chat-zentriert" width={780} height={520}>
            <A variant="chat" render={(v) => <WFOnboarding variant={v} />} />
          </DCArtboard>
          <DCArtboard id="dsh" label="C · Agent-Dashboard" width={780} height={520}>
            <A variant="dashboard" render={(v) => <WFOnboarding variant={v} />} />
          </DCArtboard>
        </DCSection>

        <DCSection id="dashboard" title="02 · Projekt-Auswahl / Dashboard" subtitle="alle projekte auf einen blick">
          <DCArtboard id="amb" label="A · Ambient" width={900} height={580}>
            <A variant="ambient" render={(v) => <WFDashboard variant={v} />} />
          </DCArtboard>
          <DCArtboard id="cha" label="B · Chat-zentriert" width={900} height={580}>
            <A variant="chat" render={(v) => <WFDashboard variant={v} />} />
          </DCArtboard>
          <DCArtboard id="dsh" label="C · Agent-Dashboard" width={900} height={580}>
            <A variant="dashboard" render={(v) => <WFDashboard variant={v} />} />
          </DCArtboard>
        </DCSection>

        <DCSection id="detail" title="03 · Projekt-Detailansicht" subtitle="struktur, ziele, tabs">
          <DCArtboard id="amb" label="A · Ambient" width={900} height={580}>
            <A variant="ambient" render={(v) => <WFProjectDetail variant={v} />} />
          </DCArtboard>
          <DCArtboard id="cha" label="B · Chat-zentriert" width={900} height={580}>
            <A variant="chat" render={(v) => <WFProjectDetail variant={v} />} />
          </DCArtboard>
          <DCArtboard id="dsh" label="C · Agent-Dashboard" width={900} height={580}>
            <A variant="dashboard" render={(v) => <WFProjectDetail variant={v} />} />
          </DCArtboard>
        </DCSection>

        <DCSection id="tasks" title="04 · Aufgaben & Checkmarks" subtitle="task-system mit unter-aufgaben + cc-vorschlägen">
          <DCArtboard id="amb" label="A · Ambient" width={900} height={620}>
            <A variant="ambient" render={(v) => <WFTasks variant={v} />} />
          </DCArtboard>
          <DCArtboard id="cha" label="B · Chat-zentriert" width={900} height={620}>
            <A variant="chat" render={(v) => <WFTasks variant={v} />} />
          </DCArtboard>
          <DCArtboard id="dsh" label="C · Agent-Dashboard" width={900} height={620}>
            <A variant="dashboard" render={(v) => <WFTasks variant={v} />} />
          </DCArtboard>
        </DCSection>

        <DCSection id="rules" title="05 · Projektregeln-Editor" subtitle="strukturiert mit kategorien — gelten immer">
          <DCArtboard id="amb" label="A · Ambient" width={900} height={560}>
            <A variant="ambient" render={(v) => <WFRules variant={v} />} />
          </DCArtboard>
          <DCArtboard id="cha" label="B · Chat-zentriert" width={900} height={560}>
            <A variant="chat" render={(v) => <WFRules variant={v} />} />
          </DCArtboard>
          <DCArtboard id="dsh" label="C · Agent-Dashboard" width={900} height={560}>
            <A variant="dashboard" render={(v) => <WFRules variant={v} />} />
          </DCArtboard>
        </DCSection>

        <DCSection id="cloud" title="06 · Cloud-Code-Status / Live-Aktivität" subtitle="was tut der agent gerade?">
          <DCArtboard id="amb" label="A · Ambient" width={900} height={620}>
            <A variant="ambient" render={(v) => <WFCloudStatus variant={v} />} />
          </DCArtboard>
          <DCArtboard id="cha" label="B · Chat-zentriert" width={900} height={620}>
            <A variant="chat" render={(v) => <WFCloudStatus variant={v} />} />
          </DCArtboard>
          <DCArtboard id="dsh" label="C · Agent-Dashboard" width={900} height={620}>
            <A variant="dashboard" render={(v) => <WFCloudStatus variant={v} />} />
          </DCArtboard>
        </DCSection>

        <DCSection id="sync" title="07 · Sync-Status / Verlauf" subtitle="handy ↔ desktop ↔ cloud">
          <DCArtboard id="amb" label="A · Ambient" width={900} height={580}>
            <A variant="ambient" render={(v) => <WFSync variant={v} />} />
          </DCArtboard>
          <DCArtboard id="cha" label="B · Chat-zentriert" width={900} height={580}>
            <A variant="chat" render={(v) => <WFSync variant={v} />} />
          </DCArtboard>
          <DCArtboard id="dsh" label="C · Agent-Dashboard" width={900} height={580}>
            <A variant="dashboard" render={(v) => <WFSync variant={v} />} />
          </DCArtboard>
        </DCSection>

        <DCSection id="mobile" title="08 · Ideen-Inbox (Mobile)" subtitle="3 capture-methoden — quick · voice · chat">
          <DCArtboard id="quick" label="A · Quick-Note" width={360} height={720}>
            <div className={cls} style={{ background: "transparent", display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
              <WFMobIdea method="quick" />
            </div>
          </DCArtboard>
          <DCArtboard id="voice" label="B · Voice-First" width={360} height={720}>
            <div className={cls} style={{ background: "transparent", display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
              <WFMobIdea method="voice" />
            </div>
          </DCArtboard>
          <DCArtboard id="chat" label="C · Konversation" width={360} height={720}>
            <div className={cls} style={{ background: "transparent", display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
              <WFMobIdea method="chat" />
            </div>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Stil">
          <TweakRadio label="Vibe" value={t.style}
            options={[{value:"sketchy", label:"sketchy"}, {value:"clean", label:"clean"}]}
            onChange={(v) => setTweak("style", v)} />
        </TweakSection>
        <TweakSection label="Darstellung">
          <TweakToggle label="Akzentfarbe" value={t.color} onChange={(v) => setTweak("color", v)} />
          <TweakRadio label="Density" value={t.density}
            options={[{value:"compact", label:"kompakt"}, {value:"regular", label:"regular"}, {value:"airy", label:"luftig"}]}
            onChange={(v) => setTweak("density", v)} />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
