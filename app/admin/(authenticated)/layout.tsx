import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/admin/auth'
import AdminShell from '@/components/admin/AdminShell'

export default async function AuthenticatedAdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin()
  if (!admin) {
    redirect('/admin/login')
  }
  return <AdminShell email={admin}>{children}</AdminShell>
}
