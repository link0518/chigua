import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { useApp } from '../store/AppContext';
import AdminDashboard from './AdminDashboard';
import { SketchButton, SketchCard, Tape } from './SketchUI';

const AdminGate: React.FC = () => {
  const { state, loadAdminSession, loginAdmin, loadReports, loadStats, showToast } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadAdminSession().catch(() => {});
  }, [loadAdminSession]);

  if (!state.adminSession.checked) {
    return (
      <div className="admin-font flex flex-col items-center justify-center min-h-[60vh]">
        <div className="font-hand text-xl text-pencil">正在检查登录状态...</div>
      </div>
    );
  }

  if (state.adminSession.loggedIn) {
    return <AdminDashboard />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      showToast('请输入管理员账号和密码', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      await loginAdmin(username.trim(), password.trim());
      await loadReports();
      await loadStats();
      showToast('登录成功，欢迎回来', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '登录失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-font flex flex-col items-center justify-center min-h-[70vh] p-4">
      <div className="max-w-md w-full">
        <SketchCard rotate className="relative">
          <Tape />
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="text-center">
              <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-ink text-white flex items-center justify-center">
                <Lock size={20} />
              </div>
              <h2 className="font-display text-3xl text-ink">管理员登录</h2>
              <p className="font-hand text-pencil mt-2">仅管理员可进入后台</p>
            </div>

            <label className="flex flex-col gap-2 font-hand text-lg text-ink">
              账号
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入管理员账号"
                className="w-full border-2 border-ink rounded-lg px-4 py-2 font-hand text-lg outline-none focus:shadow-sketch-sm"
              />
            </label>

            <label className="flex flex-col gap-2 font-hand text-lg text-ink">
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入管理员密码"
                className="w-full border-2 border-ink rounded-lg px-4 py-2 font-hand text-lg outline-none focus:shadow-sketch-sm"
              />
            </label>

            <SketchButton
              type="submit"
              fullWidth
              className="h-12 text-xl"
              disabled={isSubmitting}
            >
              {isSubmitting ? '登录中...' : '进入后台'}
            </SketchButton>
          </form>
        </SketchCard>
      </div>
    </div>
  );
};

export default AdminGate;
