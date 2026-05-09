/**
 * Type augmentation: re-introduce the legacy HTML `bgcolor` attribute on
 * <td>, <table>, <tr> and <body>. React's @types/react drops it because it is
 * "deprecated" in HTML5, but it is the only background instruction that
 * Gmail Android, Outlook desktop and Yahoo respect on outer email containers
 * (CSS-only backgrounds get stripped). Email templates therefore set both
 * `bgcolor` and inline CSS `background-color`.
 *
 * Scoping this augmentation to the email-jsx-templates folder keeps the
 * legacy attribute out of regular React app code.
 */

import 'react';

declare module 'react' {
  interface TdHTMLAttributes<T> {
    bgcolor?: string;
  }
  interface TableHTMLAttributes<T> {
    bgcolor?: string;
  }
  interface HTMLAttributes<T> {
    bgcolor?: string;
  }
}
