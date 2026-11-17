import { redirect } from 'next/navigation';

// The ELI5 CTA and old links point at /register; self-service registration
// actually lives at /registry/submit.
export default function RegisterPage() {
  redirect('/registry/submit');
}
