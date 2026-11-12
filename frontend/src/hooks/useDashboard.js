import useCompanyStore from '../stores/useCompanyStore';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboard';
import { reportsService } from '../services/reports';
import { useNotificationStore } from '../stores/notificationStore';

export const useDashboardMetrics = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  return useQuery({
    queryKey: ['dashboard', 'metrics', companyId],
    queryFn: () => dashboardService.getMetrics(),
    staleTime: 180000,
    refetchInterval: 300000,
    refetchIntervalInBackground: false,
  });
};

export const useReturnMetrics = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  return useQuery({
    queryKey: ['dashboard', 'returns', companyId],
    queryFn: () => reportsService.getReturnsMetrics(),
    staleTime: 180000,
    refetchInterval: 300000,
    refetchIntervalInBackground: false,
  });
};

export const useDashboardActivity = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  return useQuery({
    queryKey: ['dashboard', 'activity', companyId],
    queryFn: () => dashboardService.getActivity(),
    staleTime: 180000,
    refetchInterval: 300000,
    refetchIntervalInBackground: false,
  });
};

export const useDashboardAlerts = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  return useQuery({
    queryKey: ['dashboard', 'alerts', companyId],
    queryFn: () => dashboardService.getAlerts(),
    staleTime: 180000,
    refetchInterval: 300000,
    refetchIntervalInBackground: false,
  });
};

export const useResolveAlert = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore.getState();

  return useMutation({
    mutationFn: dashboardService.resolveAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'alerts', companyId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'metrics', companyId] });
      addNotification({
        type: 'success',
        title: 'Alert Resolved',
        message: 'The alert has been successfully marked as resolved.'
      });
    },
    onError: () => {
      addNotification({
        type: 'error',
        title: 'Resolution Failed',
        message: 'Could not resolve the alert. Please try again.'
      });
    }
  });
};
