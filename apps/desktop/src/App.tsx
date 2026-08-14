import { useState } from "react";
import { Button } from "@hims/ui";
import "./App.css";

function App() {
  const [ready, setReady] = useState(false);

  return (
    <main className="container">
      <h1>Divine Hands Hospital</h1>
      <p className="status">Desktop client shell — modules arrive in later build phases.</p>
      <Button onClick={() => setReady(true)}>Check shell</Button>
      {ready && <p role="status">Shell is running.</p>}
    </main>
  );
}

export default App;
