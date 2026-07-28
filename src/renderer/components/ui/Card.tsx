import * as React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export default function Card({ children, className, style }: CardProps) {
  return (
    <div className={`dashboard-card${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  );
}
