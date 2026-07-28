import * as React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="module-header">
      <div className="module-header-info">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="module-header-actions">{actions}</div>}
    </div>
  );
}
