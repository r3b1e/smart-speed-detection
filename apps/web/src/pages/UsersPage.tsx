import type { Role, User } from "@smart-speed/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Label } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAuth } from "../stores/auth";

interface UserListResponse {
  items: User[];
  total: number;
}

interface UserResponse {
  user: User;
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const currentUserId = useAuth((state) => state.user?.id);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("authority");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["users", "admin"],
    queryFn: () => apiGet<UserListResponse>("/users?page=1&limit=200"),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });
  const create = useMutation({
    mutationFn: () => apiPost<UserResponse>("/users", { name, email, password, role }),
    onSuccess: async () => {
      setName("");
      setEmail("");
      setPassword("");
      setError(null);
      await invalidate();
    },
    onError: (cause) => setError(cause.message),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { role?: Role; isActive?: boolean } }) =>
      apiPatch<UserResponse>(`/users/${id}`, patch),
    onSuccess: invalidate,
    onError: (cause) => setError(cause.message),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Administer operator access to the live gate dashboard."
      />
      <Card>
        <CardHeader>
          <CardTitle>Create operator</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_10rem_auto] md:items-end"
            onSubmit={submit}
          >
            <div>
              <Label htmlFor="new-user-name">Name</Label>
              <Input
                id="new-user-name"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-user-password">Temporary password</Label>
              <Input
                id="new-user-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-user-role">Role</Label>
              <Select
                id="new-user-role"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                <option value="admin">Admin</option>
                <option value="authority">Authority</option>
                <option value="user">User</option>
              </Select>
            </div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : <UserPlus className="h-4 w-4" />}Create
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-xs text-danger">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
      {query.isPending ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : query.isError ? (
        <ErrorState message="Could not load users." retry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState title="No operator accounts" />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="border-b border-border bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Last login</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Access</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr key={item.id} className="border-b border-border/60">
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-muted-foreground">{item.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        aria-label={`Role for ${item.email}`}
                        value={item.role}
                        onChange={(event) =>
                          update.mutate({
                            id: item.id,
                            patch: { role: event.target.value as Role },
                          })
                        }
                      >
                        <option value="admin">Admin</option>
                        <option value="authority">Authority</option>
                        <option value="user">User</option>
                      </Select>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {item.lastLoginAt ? formatDateTime(item.lastLoginAt) : "Never"}
                    </td>
                    <td className="px-4 py-3">{item.isActive ? "Active" : "Inactive"}</td>
                    <td className="px-4 py-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={item.id === currentUserId || update.isPending}
                        onClick={() =>
                          update.mutate({ id: item.id, patch: { isActive: !item.isActive } })
                        }
                      >
                        {item.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground">
            {query.data.total} accounts · your own account cannot be deactivated.
          </p>
        </Card>
      )}
    </div>
  );
}
