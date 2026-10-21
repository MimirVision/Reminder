import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Dashboard } from '../components/home/Dashboard';
import { NotificationPrompt } from '../components/Notifications';
import { Page } from '../components/Shell';
import { Button } from '../ui/button';

/** Home: a dashboard of widgets you arrange yourself. */
export function Home() {
  const [editing, setEditing] = useState(false);
  return (
    <Page title="Home" hideTitle barActions={!editing && (
      <Button variant="ghost" onClick={() => setEditing(true)} title="Add, move and resize widgets"><LayoutGrid /> <span className="hidden sm:inline">Customize</span></Button>
    )}>
      {!editing && <NotificationPrompt />}
      <Dashboard editing={editing} setEditing={setEditing} />
    </Page>
  );
}
