export function requireAnyRole(...roles) {
  return function authorize(user) {
    return roles.includes(user.role);
  };
}
