import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Tabs } from '@/components/admin/kit'
import { Alert, Badge, Button, Checkbox, Dialog, Field, Input, PageLoader, Table, Td, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import type { StaffUser } from '@/types'
import { formatDate } from '@/utils/format'

interface Role { id: number; name: string; description: string; is_system: boolean; permissions: string[] }
interface Perm { code: string; description: string }

export default function Staff() {
  const [tab, setTab] = useState<'staff' | 'roles'>('staff')
  return (
    <AdminPage title="Staff & roles" subtitle="Only Super Admins can manage staff. Staff accounts cannot be created from the storefront.">
      <Tabs tabs={[{ id: 'staff', label: 'Staff' }, { id: 'roles', label: 'Roles & permissions' }]} value={tab} onChange={setTab} />
      {tab === 'staff' ? <StaffList /> : <RoleList />}
    </AdminPage>
  )
}

function StaffList() {
  const qc = useQueryClient()
  const toast = useToast()
  const { admin } = useAdmin()
  const staff = useQuery({ queryKey: ['admin', 'staff'], queryFn: () => adminApi.get<StaffUser[]>('/admin/staff') })
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => adminApi.get<Role[]>('/admin/roles') })
  const [edit, setEdit] = useState<(Partial<StaffUser> & { password?: string; role_ids?: number[] }) | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => edit!.id
      ? adminApi.patch(`/admin/staff/${edit!.id}`, { full_name: edit!.full_name, is_active: edit!.is_active, role_ids: edit!.role_ids })
      : adminApi.post('/admin/staff', { email: edit!.email, full_name: edit!.full_name, password: edit!.password, role_ids: edit!.role_ids ?? [] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'staff'] }); setEdit(null); toast('Staff saved') }, onError: (e) => setErr(errorMessage(e)),
  })
  if (staff.isLoading || roles.isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="sm" onClick={() => { setErr(null); setEdit({ is_active: true, role_ids: [] }) }}>Add staff member</Button></div>
      <Table head={['Name', 'Email', 'Roles', 'MFA', 'Last sign-in', 'Status', '']}>
        {staff.data?.map((s) => <tr key={s.id}><Td>{s.full_name}{s.id === admin?.id && <span className="text-xs text-charcoal-500"> (you)</span>}</Td><Td>{s.email}</Td><Td>{s.roles.map((r) => r.name).join(', ')}</Td>
          <Td>{s.mfa_enabled ? <Badge tone="good">On</Badge> : <Badge tone="warn">Off</Badge>}</Td><Td className="text-xs">{formatDate(s.last_login_at, true)}</Td><Td>{s.is_active ? 'Active' : 'Disabled'}</Td>
          <Td><button className="text-xs underline" onClick={() => { setErr(null); setEdit({ ...s, role_ids: s.roles.map((r) => r.id) }) }}>Edit</button></Td></tr>)}
      </Table>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.full_name}` : 'Add staff member'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
          <div className="space-y-4">
            {err && <Alert tone="bad">{err}</Alert>}
            <Field label="Full name"><Input value={edit.full_name ?? ''} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            {!edit.id && <><Field label="Email"><Input type="email" value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
              <Field label="Temporary password" hint="At least 12 characters; ask them to change it and enable MFA."><Input type="password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field></>}
            <p className="text-[11px] uppercase tracking-[0.14em] text-charcoal-600">Roles</p>
            {roles.data?.map((r) => <Checkbox key={r.id} label={<span>{r.name} <span className="text-xs text-charcoal-500">— {r.description}</span></span>} checked={(edit.role_ids ?? []).includes(r.id)}
              onChange={(e) => setEdit({ ...edit, role_ids: e.target.checked ? [...(edit.role_ids ?? []), r.id] : (edit.role_ids ?? []).filter((x) => x !== r.id) })} />)}
            {edit.id && <Checkbox label="Account active" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />}
          </div>
        </Dialog>
      )}
    </div>
  )
}

function RoleList() {
  const qc = useQueryClient()
  const toast = useToast()
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => adminApi.get<Role[]>('/admin/roles') })
  const perms = useQuery({ queryKey: ['admin', 'permissions'], queryFn: () => adminApi.get<Perm[]>('/admin/permissions') })
  const [edit, setEdit] = useState<Partial<Role> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => { const body = { name: edit!.name, description: edit!.description ?? '', permissions: edit!.permissions ?? [] }; return edit!.id ? adminApi.put(`/admin/roles/${edit!.id}`, body) : adminApi.post('/admin/roles', body) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'roles'] }); setEdit(null); toast('Role saved') }, onError: (e) => setErr(errorMessage(e)),
  })
  const del = useMutation({ mutationFn: (id: number) => adminApi.del(`/admin/roles/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'roles'] }), onError: (e) => toast(errorMessage(e), 'bad') })
  if (roles.isLoading || perms.isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="sm" onClick={() => { setErr(null); setEdit({ permissions: [] }) }}>New role</Button></div>
      <Table head={['Role', 'Description', 'Permissions', '']}>
        {roles.data?.map((r) => <tr key={r.id}><Td>{r.name}{r.is_system && <Badge className="ml-2">Built-in</Badge>}</Td><Td className="text-xs">{r.description}</Td><Td>{r.permissions.length}</Td>
          <Td><div className="flex gap-3"><button className="text-xs underline" onClick={() => { setErr(null); setEdit(r) }}>Edit</button>{!r.is_system && <button className="text-xs text-red-800 underline" onClick={() => del.mutate(r.id)}>Delete</button>}</div></Td></tr>)}
      </Table>
      {edit && (
        <Dialog open wide onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : 'New role'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
          <div className="space-y-4">
            {err && <Alert tone="bad">{err}</Alert>}
            <div className="grid gap-4 md:grid-cols-2"><Field label="Name"><Input value={edit.name ?? ''} disabled={edit.is_system} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Description"><Input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field></div>
            <div className="grid gap-2 md:grid-cols-2">
              {perms.data?.map((p) => <Checkbox key={p.code} label={<span><code className="text-xs">{p.code}</code> <span className="text-xs text-charcoal-500">{p.description}</span></span>} checked={(edit.permissions ?? []).includes(p.code)} disabled={edit.name === 'Super Admin'}
                onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? [...(edit.permissions ?? []), p.code] : (edit.permissions ?? []).filter((x) => x !== p.code) })} />)}
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
