import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';

export function Header() {
  const { user, profile, signOut } = useAuth();
  const name = profile?.full_name || user?.user_metadata?.full_name || user?.email;
  const avatar = profile?.avatar_url || user?.user_metadata?.avatar_url;

  return (
    <header className="header">
      <Link to="/" className="brand">G-Map</Link>
      <div className="header-user">
        {avatar && <img src={avatar} alt="" className="avatar" referrerPolicy="no-referrer" />}
        <span className="small">{name}</span>
        <button className="btn btn-ghost" onClick={signOut}>Log out</button>
      </div>
    </header>
  );
}
