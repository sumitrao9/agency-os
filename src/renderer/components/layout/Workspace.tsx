import { useUIStore } from '../../stores/ui.store';
import HomeModule from '../../features/home/HomeModule';
import DashboardModule from '../../features/dashboard/DashboardModule';
import LeadsModule from '../../features/leads/LeadsModule';
import BrowserModule from '../../features/BrowserModule';
import EmailModule from '../../features/EmailModule';
import AutomationsModule from '../../features/AutomationsModule';
import JobsModule from '../../features/JobsModule';
import RulesModule from '../../features/RulesModule';
import FilesModule from '../../features/FilesModule';
import DevToolsModule from '../../features/DevToolsModule';
import NotificationsModule from '../../features/NotificationsModule';

export default function Workspace() {
  const { activeModule } = useUIStore();

  const renderModule = () => {
    switch (activeModule) {
      case 'home':
        return <HomeModule />;
      case 'dashboard':
        return <DashboardModule />;
      case 'leads':
        return <LeadsModule />;
      case 'browser':
        return <BrowserModule />;
      case 'email':
        return <EmailModule />;
      case 'automations':
        return <AutomationsModule />;
      case 'jobs':
        return <JobsModule />;
      case 'rules':
        return <RulesModule />;
      case 'files':
        return <FilesModule />;
      case 'devtools':
        return <DevToolsModule />;
      case 'notifications':
        return <NotificationsModule />;
      default:
        return <DashboardModule />;
    }
  };

  return (
    <main className="content-area">
      <div className="main-content">
        {renderModule()}
      </div>
    </main>
  );
}
